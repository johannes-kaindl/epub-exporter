export interface BookMetadata {
  title: string;
  authors: string[];
  language: string;
  identifier: string; // urn:uuid:... (auto-filled if absent)
  description?: string;
  publisher?: string;
  date?: string;
  series?: string;
  seriesIndex?: string;
  subjects?: string[];
  rights?: string;
  modified?: string; // ISO 8601; EPUB3 dcterms:modified. Plugin supplies real time.
  coverImagePath?: string; // raw frontmatter value (e.g. "[[cover.png]]"); resolved in Plan 2
}

export interface Chapter {
  title: string;
  xhtml: string; // inner XHTML for the chapter body
  sourcePath?: string; // vault path, used for cross-chapter link resolution (Plan 2)
}

export interface ImageAsset {
  id: string; // OPF manifest id, e.g. "img-01"
  href: string; // path relative to OEBPS/, e.g. "images/img-01.png"
  mediaType: string; // e.g. "image/png"
  data: Uint8Array;
}

export interface Book {
  metadata: BookMetadata;
  chapters: Chapter[];
  images: ImageAsset[];
  coverImageId?: string; // ImageAsset.id of the cover, if any
  css: string;
}
