# Two availability zones; public subnets hold only the load balancer and NAT gateway; all
# workloads and data stores live in private subnets with no public IPs.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = "blue-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  tags              = { Name = "${local.name}-public-${local.azs[count.index]}", Tier = "public" }
}

resource "aws_subnet" "private" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 10 + count.index)
  tags              = { Name = "${local.name}-private-${local.azs[count.index]}", Tier = "private" }
}

# One NAT gateway for staging (cost). Production: one per AZ so an AZ outage can't cut egress.
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${local.name}-nat" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = local.name }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = { Name = "${local.name}-private" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# --- Security groups: each tier accepts traffic only from the tier in front of it. ---

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public HTTPS entry point"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "Redirected to HTTPS"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_apps" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.apps.id
  ip_protocol                  = "-1"
}

resource "aws_security_group" "apps" {
  name        = "${local.name}-apps"
  description = "ECS tasks: API, worker, web apps, one-off jobs"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "apps_from_alb" {
  for_each                     = { api = 4000, web = 3000 }
  security_group_id            = aws_security_group.apps.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}

resource "aws_vpc_security_group_egress_rule" "apps_all" {
  security_group_id = aws_security_group.apps.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "ECR, Secrets Manager, CloudWatch, SMS provider (via NAT); RDS and Valkey"
}

resource "aws_security_group" "data" {
  name        = "${local.name}-data"
  description = "RDS PostgreSQL and ElastiCache Valkey"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "data_postgres" {
  security_group_id            = aws_security_group.data.id
  referenced_security_group_id = aws_security_group.apps.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "data_valkey" {
  security_group_id            = aws_security_group.data.id
  referenced_security_group_id = aws_security_group.apps.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}
