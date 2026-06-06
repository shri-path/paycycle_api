export interface ListQueryParams {
  page?: number;
  limit?: number;
  sort?: string[];
  select?: string[];
  filter?: Record<string, unknown>;
  search?: {
    query: string;
    fields: string[];
  };
}

export interface ParsedListQuery {
  where: Record<string, unknown>;
  orderBy: Record<string, string>[];
  skip: number;
  take: number;
  select?: Record<string, boolean> | undefined;
}
