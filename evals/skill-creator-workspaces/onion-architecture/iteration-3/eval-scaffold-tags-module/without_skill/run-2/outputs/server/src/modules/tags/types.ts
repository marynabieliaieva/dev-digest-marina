// Domain types for tags: no framework, DB or HTTP imports here.
export interface Tag {
  id: string;
  repoId: string;
  name: string;
  color: string; // #RRGGBB
  createdAt: Date;
}

export interface NewTag {
  repoId: string;
  name: string;
  color: string;
}

// Port: the service depends on this interface, not on Drizzle.
export interface TagRepositoryPort {
  listByRepo(repoId: string): Promise<Tag[]>;
  findByName(repoId: string, name: string): Promise<Tag | null>;
  create(input: NewTag): Promise<Tag>;
  delete(repoId: string, id: string): Promise<boolean>;
}
