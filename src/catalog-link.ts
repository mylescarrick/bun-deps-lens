import type { DepLocation } from "./types";

export interface CatalogReference {
  catalogName?: string;
  name: string;
}

interface Position {
  character: number;
  line: number;
}

const CATALOG_PREFIX = "catalog:";

function isCatalogDefinitionSection(location: DepLocation): boolean {
  return (
    location.section === "workspaces.catalog" ||
    location.section === "workspaces.catalogs"
  );
}

function containsPosition(location: DepLocation, position: Position): boolean {
  if (
    position.line < location.valueStartLine ||
    position.line > location.valueEndLine
  ) {
    return false;
  }
  if (
    position.line === location.valueStartLine &&
    position.character < location.valueStartCol
  ) {
    return false;
  }
  if (
    position.line === location.valueEndLine &&
    position.character > location.valueEndCol
  ) {
    return false;
  }
  return true;
}

// Parses a consumer value like `catalog:` or `catalog:build` into a reference,
// or undefined if it isn't a catalog specifier at all.
export function catalogReferenceFromDeclaredRange(
  name: string,
  declaredRange: string
): CatalogReference | undefined {
  if (!declaredRange.startsWith(CATALOG_PREFIX)) {
    return;
  }
  const suffix = declaredRange.slice(CATALOG_PREFIX.length);
  return { catalogName: suffix === "" ? undefined : suffix, name };
}

// Finds the `catalog:` (or `catalog:<name>`) reference at `position`, if any —
// i.e. a consumer entry like `"react": "catalog:build"`, not a catalog
// definition block itself.
export function findCatalogReference(
  locations: DepLocation[],
  position: Position
): CatalogReference | undefined {
  const location = locations.find(
    (loc) =>
      !isCatalogDefinitionSection(loc) &&
      loc.declaredRange.startsWith(CATALOG_PREFIX) &&
      containsPosition(loc, position)
  );
  return location === undefined
    ? undefined
    : catalogReferenceFromDeclaredRange(location.name, location.declaredRange);
}

// Finds the definition of `reference` among the locations parsed from the
// root package.json (which may be `locations` itself, if editing the root).
export function findCatalogDefinition(
  rootLocations: DepLocation[],
  reference: CatalogReference
): DepLocation | undefined {
  return rootLocations.find(
    (loc) =>
      loc.name === reference.name &&
      isCatalogDefinitionSection(loc) &&
      loc.catalogName === reference.catalogName
  );
}
