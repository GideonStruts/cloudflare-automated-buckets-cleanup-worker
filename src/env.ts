export interface Env {
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  RETENTION_DAYS?: string;
  DRY_RUN?: string;
  JURISDICTIONS?: string;
  BACKUP_SUFFIXES?: string;
  BUCKETS?: string;
}
