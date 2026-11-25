import { endpoints } from '@blue/contracts';
import { Controller, Module } from '@nestjs/common';
import { Endpoint } from '../kernel/contract/endpoint.decorator.js';
import { Public } from '../platform/access/access-policy.js';
import { buildOpenApi, type OpenApiDocument } from './build-openapi.js';

/** Serves the generated document. Mounted only outside production (see AppModule). */
@Controller()
@Public()
export class OpenApiController {
  private document: OpenApiDocument | undefined;

  @Endpoint(endpoints.system.openapi)
  openapi(): OpenApiDocument {
    this.document ??= buildOpenApi();
    return this.document;
  }
}

@Module({ controllers: [OpenApiController] })
export class OpenApiModule {}
