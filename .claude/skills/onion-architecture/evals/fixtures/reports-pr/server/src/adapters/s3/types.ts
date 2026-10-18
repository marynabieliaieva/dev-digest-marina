export interface ExportRequest {
  key: string;
  contentType: string;
  body: Uint8Array;
}

export interface ReportExporter {
  upload(request: ExportRequest): Promise<string>;
}
