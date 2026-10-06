export type StudioPageItem = number | 'ellipsis';

export const buildPageItems = (current: number, total: number): StudioPageItem[] => {
  if (!Number.isFinite(total)) return [];

  const pageCount = Math.floor(total);
  if (pageCount < 1) return [];

  const currentPage = Number.isFinite(current)
    ? Math.min(pageCount, Math.max(1, Math.floor(current)))
    : 1;

  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis', pageCount];
  }

  if (currentPage >= pageCount - 3) {
    return [1, 'ellipsis', ...Array.from({ length: 5 }, (_, index) => pageCount - 4 + index)];
  }

  return [1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', pageCount];
};
