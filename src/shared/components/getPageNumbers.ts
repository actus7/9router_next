"use client";

export function getPageNumbers(currentPage: number, totalPages: number): number[] {
  const pages: number[] = [];
  const showMax = 5;
  let start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, start + showMax - 1);
  if (end - start + 1 < showMax) start = Math.max(1, end - showMax + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
}
