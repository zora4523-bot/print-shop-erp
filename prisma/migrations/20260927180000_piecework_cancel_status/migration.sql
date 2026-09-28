-- Commit the enum addition before any subsequent migration uses its value.
ALTER TYPE "PieceworkPriceBookStatus" ADD VALUE 'CANCELLED';
