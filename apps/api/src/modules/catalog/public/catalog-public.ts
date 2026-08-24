export interface CatalogPublicMaterial {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly vendor: { readonly id: string; readonly slug: string; readonly name: string };
}
