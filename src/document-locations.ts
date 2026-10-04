import { findDependencyLocations } from "./package-json";
import type { DepLocation } from "./types";

interface DependencyDocument {
  getText: () => string;
  uri: { toString: () => string };
  version: number;
}

export class DependencyLocationsCache {
  private readonly entries = new Map<
    string,
    { locations: DepLocation[]; version: number }
  >();

  get(document: DependencyDocument): DepLocation[] {
    const key = document.uri.toString();
    const entry = this.entries.get(key);
    if (entry?.version === document.version) {
      return entry.locations;
    }
    const locations = findDependencyLocations(document.getText());
    this.entries.set(key, { locations, version: document.version });
    return locations;
  }

  delete(uri: string): void {
    this.entries.delete(uri);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const dependencyLocations = new DependencyLocationsCache();
