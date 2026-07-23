import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class names, resolving conflicting Tailwind utility classes. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

/** Shortens a hex contract address to `0x1234abcd...5678efgh` for display. */
export const toShortContractAddress = (contractAddress: string | undefined): string | undefined =>
  contractAddress?.replace(/^[A-Fa-f0-9]{6}([A-Fa-f0-9]{8}).*([A-Fa-f0-9]{8})$/g, '0x$1...$2');
