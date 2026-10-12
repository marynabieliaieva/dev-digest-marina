export interface IssueTracker {
  close(issueNumber: number): Promise<void>;
  assign(issueNumber: number, assignee: string): Promise<void>;
}
