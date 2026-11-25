import { HealthController } from '../platform/health/health.controller.js';
import { AuthController } from '../platform/identity/auth.controller.js';
import { MeController } from '../platform/identity/me.controller.js';
import { ReferenceController } from '../platform/reference/reference.module.js';
import { OrganisationsController } from '../platform/tenancy/organisations.controller.js';
import { CatalogueController } from '../samakios/catalogue/catalogue.module.js';
import { PartnersController } from '../samakios/partners/partners.module.js';
import { OpenApiController } from './openapi.controller.js';

/**
 * Every controller the API mounts, so the OpenAPI document can be built without booting the app.
 * contract.test.ts fails if this list and the running application disagree.
 *
 * A function, not a constant: OpenApiController (in this list) imports the builder, which imports
 * this file. Building the array lazily keeps that cycle safe under Node's ESM rules, where
 * referencing a not-yet-initialised class at module load throws (module-graph.test.ts).
 */
export function apiControllers() {
  return [
    HealthController,
    AuthController,
    MeController,
    OrganisationsController,
    ReferenceController,
    CatalogueController,
    PartnersController,
    OpenApiController,
  ] as const;
}
