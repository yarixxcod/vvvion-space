declare module "sanitize-html" {
  export interface Attributes {
    [key: string]: string;
  }
  export interface SanitizeOptions {
    allowedTags?: string[];
    allowedAttributes?: Record<string, string[]>;
    allowedStyles?: Record<string, Record<string, RegExp[]>>;
    allowedSchemes?: string[];
    allowedSchemesByTag?: Record<string, string[]>;
    allowProtocolRelative?: boolean;
    disallowedTagsMode?: "discard" | "escape" | "completelyDiscard" | "recursiveEscape";
    nestingLimit?: number;
    transformTags?: Record<
      string,
      (tagName: string, attribs: Attributes) => { tagName: string; attribs?: Attributes; text?: string }
    >;
  }
  export default function sanitizeHtml(dirty: string, options?: SanitizeOptions): string;
}
