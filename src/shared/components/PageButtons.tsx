"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getPageNumbers } from "./getPageNumbers";

interface PageButtonsProps {
  currentPage: number; totalPages: number; onPageChange: (p: number) => void;
}

export function PageButtons({ currentPage, totalPages, onPageChange }: PageButtonsProps) {
  if (totalPages <= 1) return null;
  const pageNumbers = getPageNumbers(currentPage, totalPages);
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="w-9 px-0"><ChevronLeft className="size-5" /></Button>
      {pageNumbers[0] > 1 && (<><Button variant="ghost" size="sm" onClick={() => onPageChange(1)} className="w-9 px-0 hidden sm:inline-flex">1</Button>{pageNumbers[0] > 2 && <span className="text-text-muted px-1 hidden sm:inline">...</span>}</>)}
      {pageNumbers.map((p) => (<Button key={p} variant={currentPage === p ? "default" : "ghost"} size="sm" onClick={() => onPageChange(p)} className={cn("w-9 px-0", currentPage === p ? "inline-flex" : "hidden sm:inline-flex")}>{p}</Button>))}
      {pageNumbers[pageNumbers.length - 1] < totalPages && (<>{pageNumbers[pageNumbers.length - 1] < totalPages - 1 && <span className="text-text-muted px-1 hidden sm:inline">...</span>}<Button variant="ghost" size="sm" onClick={() => onPageChange(totalPages)} className="w-9 px-0 hidden sm:inline-flex">{totalPages}</Button></>)}
      <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="w-9 px-0"><ChevronRight className="size-5" /></Button>
    </div>
  );
}
