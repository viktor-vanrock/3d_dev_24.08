import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { CATALOG_PORT, type CatalogPort, type CatalogQuery } from "../public/index.ts";
import { ApiCatalogRead } from "./openapi.ts";

@Controller()
export class CatalogController {
  constructor(@Inject(CATALOG_PORT) private readonly catalog: CatalogPort) {}

  @Get("releases")
  @ApiCatalogRead("List printer release events")
  releases(@Query() query: CatalogQuery) {
    return this.catalog.releases(query);
  }

  @Get("materials")
  @ApiCatalogRead("List catalog materials")
  materials(@Query() query: CatalogQuery) {
    return this.catalog.materials(query);
  }

  @Get("materials/:id")
  @ApiCatalogRead("Read a catalog material")
  material(@Param("id") id: string, @Query() query: CatalogQuery) {
    return this.catalog.material(id, query);
  }

  @Get("vendors")
  @ApiCatalogRead("List catalog vendors")
  vendors() {
    return this.catalog.vendors();
  }

  @Get("machines")
  @ApiCatalogRead("List catalog machines")
  machines(@Query() query: CatalogQuery) {
    return this.catalog.machines(query);
  }

  @Get("machines/:id")
  @ApiCatalogRead("Read a catalog machine")
  machine(@Param("id") id: string, @Query() query: CatalogQuery) {
    return this.catalog.machine(id, query);
  }

  @Get("printers")
  @ApiCatalogRead("List the public printer catalog")
  printers(@Query() query: CatalogQuery) {
    return this.catalog.printers(query);
  }

  @Get("printers/:slug")
  @ApiCatalogRead("Read a public printer catalog card")
  printer(@Param("slug") slug: string) {
    return this.catalog.printer(slug);
  }

  @Get("catalog/metrics")
  @ApiCatalogRead("Read catalog coverage metrics", true)
  metrics() {
    return this.catalog.metrics();
  }

  @Get("material-candidates")
  @ApiCatalogRead("List material candidates", true)
  materialCandidates(@Query() query: CatalogQuery) {
    return this.catalog.materialCandidates(query);
  }

  @Post("material-candidates")
  @HttpCode(201)
  @ApiCatalogRead("Suggest a material candidate", true, 201)
  suggestMaterialCandidate(@Req() request: RequestWithSession, @Body() body: CatalogQuery) {
    return this.catalog.suggestMaterialCandidate(this.userId(request), body, request);
  }

  @Post("material-candidates/:id/approve")
  @HttpCode(200)
  @ApiCatalogRead("Approve a material candidate", true)
  approveMaterialCandidate(@Param("id") id: string) {
    return this.catalog.approveMaterialCandidate(id);
  }

  @Post("material-candidates/:id/reject")
  @HttpCode(200)
  @ApiCatalogRead("Reject a material candidate", true)
  rejectMaterialCandidate(@Param("id") id: string) {
    return this.catalog.rejectMaterialCandidate(id);
  }

  @Get("machine-candidates")
  @ApiCatalogRead("List machine candidates", true)
  machineCandidates(@Query() query: CatalogQuery) {
    return this.catalog.machineCandidates(query);
  }

  @Post("machine-candidates")
  @HttpCode(201)
  @ApiCatalogRead("Suggest a machine candidate", true, 201)
  suggestMachineCandidate(@Req() request: RequestWithSession, @Body() body: CatalogQuery) {
    return this.catalog.suggestMachineCandidate(this.userId(request), body, request);
  }

  @Post("machine-candidates/:id/approve")
  @HttpCode(200)
  @ApiCatalogRead("Approve a machine candidate", true)
  approveMachineCandidate(@Param("id") id: string) {
    return this.catalog.approveMachineCandidate(id);
  }

  @Post("machine-candidates/:id/reject")
  @HttpCode(200)
  @ApiCatalogRead("Reject a machine candidate", true)
  rejectMachineCandidate(@Param("id") id: string) {
    return this.catalog.rejectMachineCandidate(id);
  }

  private userId(request: RequestWithSession): string {
    const session = request[SESSION_USER];
    if (session === undefined) throw new UnauthorizedException();
    return session.id;
  }
}
