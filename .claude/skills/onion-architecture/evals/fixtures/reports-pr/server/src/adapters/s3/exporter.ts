import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ExportRequest, ReportExporter } from './types.js';

export class S3ReportExporter implements ReportExporter {
  private readonly client: S3Client;

  constructor(private readonly bucket: string, region: string) {
    this.client = new S3Client({ region });
  }

  async upload(request: ExportRequest): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: request.key,
        Body: request.body,
        ContentType: request.contentType,
      }),
    );
    return `https://${this.bucket}.s3.amazonaws.com/${request.key}`;
  }
}
