import { config } from '@/infrastructure/config';
import { BadRequestError } from '@/common/errors/app-error';
import { ListQueryParams, ParsedListQuery } from './types';

export class QueryBuilder {
  static parseListQuery(params: ListQueryParams, allowedFields?: string[]): ParsedListQuery {
    const { page = 1, limit, sort, select, filter, search } = params;

    const pagination = this.parsePagination(page, limit);
    const orderBy = sort ? this.parseSorting(sort, allowedFields) : [];
    const where = filter ? this.parseFilter(filter, allowedFields) : {};
    const searchWhere = search ? this.parseSearch(search, allowedFields) : {};

    const combinedWhere =
      Object.keys(searchWhere).length > 0 ? { AND: [where, searchWhere] } : where;

    const selectClause = select ? this.parseSelect(select, allowedFields) : undefined;

    const result: ParsedListQuery = {
      where: combinedWhere,
      orderBy,
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    };
    if (selectClause !== undefined) {
      result.select = selectClause;
    }
    return result;
  }

  private static parsePagination(page: number, limit?: number): { page: number; limit: number } {
    const parsedPage = Math.max(1, Math.floor(page));
    const parsedLimit = limit
      ? Math.min(config.pagination.maxPageSize, Math.max(1, Math.floor(limit)))
      : config.pagination.defaultPageSize;
    return { page: parsedPage, limit: parsedLimit };
  }

  private static parseSorting(sort: string[], allowedFields?: string[]): Record<string, string>[] {
    return sort.map((field) => {
      const isDescending = field.startsWith('-');
      const fieldName = isDescending ? field.slice(1) : field;
      if (allowedFields && !allowedFields.includes(fieldName)) {
        throw new BadRequestError(`Invalid sort field: ${fieldName}`);
      }
      return { [fieldName]: isDescending ? 'desc' : 'asc' };
    });
  }

  private static parseSelect(
    select: string[],
    allowedFields?: string[]
  ): Record<string, boolean> | undefined {
    if (!select || select.length === 0) return undefined;
    const selectClause: Record<string, boolean> = {};
    for (const field of select) {
      if (allowedFields && !allowedFields.includes(field)) {
        throw new BadRequestError(`Invalid select field: ${field}`);
      }
      selectClause[field] = true;
    }
    return selectClause;
  }

  private static parseFilter(
    filter: Record<string, unknown>,
    _allowedFields?: string[]
  ): Record<string, unknown> {
    // Simple filter parsing — expand as needed
    return filter;
  }

  private static parseSearch(
    search: { query: string; fields: string[] },
    _allowedFields?: string[]
  ): Record<string, unknown> {
    const { query, fields } = search;
    if (!query || fields.length === 0) return {};
    return {
      OR: fields.map((field) => ({
        [field]: { contains: query, mode: 'insensitive' },
      })),
    };
  }
}
