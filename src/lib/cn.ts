import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 合并 className：clsx 处理条件类，twMerge 解决 tailwind 类冲突（后者覆盖前者） */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
