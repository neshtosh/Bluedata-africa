# One public Application Load Balancer with TLS, routing by host name to the three services.
# The certificate is validated by DNS: create the records from the `certificate_validation`
# output at whichever DNS provider hosts the domain (Route 53, Cloudflare, …).

resource "aws_acm_certificate" "main" {
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn = aws_acm_certificate.main.arn
  # Waits until the DNS validation records exist; apply blocks here on first run.
}

resource "aws_lb" "main" {
  name                       = local.name
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
  idle_timeout               = 60
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api"
  port        = 4000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id
  health_check {
    path                = "/health/ready" # database and Valkey reachable
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  deregistration_delay = 30
}

resource "aws_lb_target_group" "web" {
  for_each    = toset(["samakios-web", "bluedata-web"])
  name        = "${local.name}-${each.key}"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id
  health_check {
    path     = "/sign-in"
    matcher  = "200"
    interval = 15
  }
  deregistration_delay = 30
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.main.certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "hosts" {
  for_each = {
    api          = { host = local.api_host, target = aws_lb_target_group.api.arn, priority = 10 }
    samakios-web = { host = local.samakios_host, target = aws_lb_target_group.web["samakios-web"].arn, priority = 20 }
    bluedata-web = { host = local.bluedata_host, target = aws_lb_target_group.web["bluedata-web"].arn, priority = 30 }
  }
  listener_arn = aws_lb_listener.https.arn
  priority     = each.value.priority
  action {
    type             = "forward"
    target_group_arn = each.value.target
  }
  condition {
    host_header { values = [each.value.host] }
  }
}
