import type { SaaSTables, SaaSViews } from "./database.types";

type MyGenericRelationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};
type MyGenericTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: MyGenericRelationship[];
};
type MyGenericView = {
  Row: Record<string, unknown>;
  Relationships: MyGenericRelationship[];
};

type CheckSaaSTables = SaaSTables extends Record<string, MyGenericTable> ? true : false;
type CheckSaaSViews = SaaSViews extends Record<string, MyGenericView> ? true : false;

const cSaaSTables: CheckSaaSTables = true;
const cSaaSViews: CheckSaaSViews = true;
