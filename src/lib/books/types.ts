export type BookFormat = "epub" | "fb2" | "txt" | "pdf";

export type BookChapter = {
  title: string;
  html: string;
};

export type ParsedBook = {
  title: string;
  author: string;
  language: string;
  format: BookFormat;
  cover: string;
  chapters: BookChapter[];
  words: number;
};

export type ShelfBook = {
  id: string;
  ownerId: string;
  title: string;
  author: string;
  language: string;
  format: BookFormat;
  cover: string;
  fileName: string;
  words: number;
  chapters: number;
  addedAt: number;
  openedAt: number;
  chapter: number;
  ratio: number;
  ownerName?: string;
  ownerImage?: string | null;
  removable?: boolean;
};
