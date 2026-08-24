import { ApiProperty } from "@nestjs/swagger";
import { PROJECT_CRAFTS, PROJECT_MANUFACTURING_METHODS, PROJECT_REVISION_STATUSES, PROJECT_SOURCE_FORMATS } from "../domain/project.ts";

export class ProjectOwnerDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String }) username!: string;
  @ApiProperty({ nullable: true, type: String }) display_name!: string | null;
  @ApiProperty({ nullable: true, type: String, format: "uri" }) avatar_url!: string | null;
}

export class ModelSummaryDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String, format: "uuid" }) project_id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Number, minimum: 0 }) position!: number;
  @ApiProperty({ type: String, format: "uuid" }) latest_revision_id!: string;
  @ApiProperty({ format: "uuid", nullable: true, type: String }) active_revision_id!: string | null;
  @ApiProperty({ type: String, enum: PROJECT_REVISION_STATUSES }) latest_revision_status!: string;
  @ApiProperty({ type: Number, minimum: 1 }) version!: number;
  @ApiProperty({ type: String, format: "date-time" }) created_at!: string;
  @ApiProperty({ type: String, format: "date-time" }) updated_at!: string;
}

export class ProjectSummaryDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ type: ProjectOwnerDto }) owner!: ProjectOwnerDto;
  @ApiProperty({ type: String, enum: ["draft", "published"] }) publication_state!: string;
  @ApiProperty({ format: "uuid", nullable: true, type: String }) primary_model_id!: string | null;
  @ApiProperty({ format: "uuid", nullable: true, type: String }) published_revision_id!: string | null;
  @ApiProperty({ type: Number, minimum: 0 }) models_count!: number;
  @ApiProperty({ type: Number, minimum: 1 }) version!: number;
  @ApiProperty({ type: String, format: "date-time" }) created_at!: string;
  @ApiProperty({ type: String, format: "date-time" }) updated_at!: string;
}

export class ProjectDraftDto extends ProjectSummaryDto {
  @ApiProperty({ nullable: true, type: String, format: "uri" }) repo_url!: string | null;
  @ApiProperty({ nullable: true, type: ModelSummaryDto }) primary_model!: ModelSummaryDto | null;
}

export class PublishedProjectDto extends ProjectSummaryDto {
  @ApiProperty({ type: String, format: "uuid" }) project_revision_id!: string;
  @ApiProperty({ type: String, format: "date-time" }) published_at!: string;
  @ApiProperty({ type: [ModelSummaryDto] }) published_models!: ModelSummaryDto[];
}

export class BboxMmDto {
  @ApiProperty({ type: [Number], minItems: 3, maxItems: 3 }) min!: [number, number, number];
  @ApiProperty({ type: [Number], minItems: 3, maxItems: 3 }) max!: [number, number, number];
  @ApiProperty({ type: [Number], minItems: 3, maxItems: 3 }) size!: [number, number, number];
  @ApiProperty({ type: String, enum: ["mm"] }) unit!: "mm";
}

export class ModelRevisionDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String, format: "uuid" }) model_id!: string;
  @ApiProperty({ type: String, enum: PROJECT_REVISION_STATUSES }) status!: string;
  @ApiProperty({ type: String, enum: PROJECT_SOURCE_FORMATS }) source_format!: string;
  @ApiProperty({ type: String, enum: PROJECT_CRAFTS }) craft!: string;
  @ApiProperty({ enum: PROJECT_MANUFACTURING_METHODS, nullable: true, type: String }) manufacturing_method!: string | null;
  @ApiProperty({ type: Boolean }) requires_ams!: boolean;
  @ApiProperty({ nullable: true, type: BboxMmDto }) bbox!: BboxMmDto | null;
  @ApiProperty({ nullable: true, type: String }) failure_code!: string | null;
  @ApiProperty({ type: Number, minimum: 0 }) source_size_bytes!: number;
  @ApiProperty({ type: String, pattern: "^[0-9a-f]{64}$" }) source_checksum_sha256!: string;
  @ApiProperty({ type: String, format: "uri-reference" }) source_url!: string;
  @ApiProperty({ nullable: true, type: String, format: "uri-reference" }) preview_url!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) created_at!: string;
  @ApiProperty({ format: "date-time", nullable: true, type: String }) processing_started_at!: string | null;
  @ApiProperty({ format: "date-time", nullable: true, type: String }) ready_at!: string | null;
  @ApiProperty({ format: "date-time", nullable: true, type: String }) failed_at!: string | null;
}

export class ProjectDraftResponseDto {
  @ApiProperty({ type: String, enum: ["project-api.v1"] }) contract_version!: "project-api.v1";
  @ApiProperty({ type: ProjectDraftDto }) project!: ProjectDraftDto;
}

export class PublishedProjectResponseDto {
  @ApiProperty({ type: String, enum: ["project-api.v1"] }) contract_version!: "project-api.v1";
  @ApiProperty({ type: PublishedProjectDto }) project!: PublishedProjectDto;
}

export class ProjectListResponseDto {
  @ApiProperty({ type: String, enum: ["project-api.v1"] }) contract_version!: "project-api.v1";
  @ApiProperty({ type: [ProjectSummaryDto] }) items!: ProjectSummaryDto[];
  @ApiProperty({ nullable: true, type: String, maxLength: 512 }) next_cursor!: string | null;
}

export class ModelResponseDto {
  @ApiProperty({ type: String, enum: ["project-api.v1"] }) contract_version!: "project-api.v1";
  @ApiProperty({ type: ModelSummaryDto }) model!: ModelSummaryDto;
}

export class ModelListResponseDto {
  @ApiProperty({ type: String, enum: ["project-api.v1"] }) contract_version!: "project-api.v1";
  @ApiProperty({ type: [ModelSummaryDto] }) items!: ModelSummaryDto[];
  @ApiProperty({ nullable: true, type: String, maxLength: 512 }) next_cursor!: string | null;
}

export class ModelRevisionResponseDto {
  @ApiProperty({ type: String, enum: ["project-api.v1"] }) contract_version!: "project-api.v1";
  @ApiProperty({ type: ModelRevisionDto }) revision!: ModelRevisionDto;
}

export class ModelRevisionListResponseDto {
  @ApiProperty({ type: String, enum: ["project-api.v1"] }) contract_version!: "project-api.v1";
  @ApiProperty({ type: [ModelRevisionDto] }) items!: ModelRevisionDto[];
  @ApiProperty({ nullable: true, type: String, maxLength: 512 }) next_cursor!: string | null;
}

export class PublicationDto {
  @ApiProperty({ type: String, format: "uuid" }) project_revision_id!: string;
  @ApiProperty({ type: String, format: "uuid" }) project_id!: string;
  @ApiProperty({ type: Number, minimum: 1 }) version!: number;
  @ApiProperty({ type: String, format: "date-time" }) published_at!: string;
}

export class PublicationResponseDto {
  @ApiProperty({ type: String, enum: ["project-api.v1"] }) contract_version!: "project-api.v1";
  @ApiProperty({ type: PublicationDto }) publication!: PublicationDto;
}
