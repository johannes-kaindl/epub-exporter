import { ImageAsset } from "./model";

const EXT_MEDIA: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

export function mediaTypeForPath(path: string): string | null {
  return EXT_MEDIA[extOf(path)] ?? null;
}

export interface ImageSource {
  data: Uint8Array;
  path: string; // vault path (for extension/media-type)
}

export class ImageRegistry {
  private assets: ImageAsset[] = [];
  private bySrc = new Map<string, { id: string; href: string }>();
  private byPath = new Map<string, { id: string; href: string }>();
  private counter = 0;

  constructor(private read: (src: string, sourcePath: string) => Promise<ImageSource | null>) {}

  async resolve(src: string, sourcePath: string): Promise<{ id: string; href: string } | null> {
    const seen = this.bySrc.get(src);
    if (seen) return seen;
    const got = await this.read(src, sourcePath);
    if (!got) return null;
    // Two distinct srcs (bare cover filename vs. inline app:// URL) can resolve to the same
    // vault file; dedup on the resolved path so the asset is embedded once.
    const canon = this.byPath.get(got.path);
    if (canon) {
      this.bySrc.set(src, canon);
      return canon;
    }
    const mediaType = mediaTypeForPath(got.path);
    if (!mediaType) return null;
    this.counter++;
    const id = `img-${String(this.counter).padStart(2, "0")}`;
    const href = `images/${id}.${extOf(got.path)}`;
    this.assets.push({ id, href, mediaType, data: got.data });
    const ref = { id, href };
    this.bySrc.set(src, ref);
    this.byPath.set(got.path, ref);
    return ref;
  }

  images(): ImageAsset[] {
    return this.assets;
  }
}
