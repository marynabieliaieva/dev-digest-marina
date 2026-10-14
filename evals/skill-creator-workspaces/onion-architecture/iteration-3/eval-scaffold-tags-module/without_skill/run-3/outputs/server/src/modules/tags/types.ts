export interface Tag {
  id: string;
  repoId: string;
  name: string;
  color: string;
  createdAt: Date;
}

export interface NewTag {
  repoId: string;
  name: string;
  color: string;
}
