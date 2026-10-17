CREATE TABLE "eval_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"agent_version" integer NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"cases_total" integer NOT NULL,
	"cases_done" integer DEFAULT 0 NOT NULL,
	"traces_passed" integer,
	"traces_total" integer,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"cost_usd" double precision,
	"duration_ms" integer
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "eval_batches" ADD CONSTRAINT "eval_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_batches" ADD CONSTRAINT "eval_batches_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_batches_agent_scope_started_idx" ON "eval_batches" USING btree ("agent_id","scope","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_batches_one_running_per_agent_uq" ON "eval_batches" USING btree ("agent_id") WHERE "eval_batches"."status" = 'running';--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_source_finding_id_findings_id_fk" FOREIGN KEY ("source_finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_batch_id_eval_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."eval_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_owner_source_uq" ON "eval_cases" USING btree ("owner_kind","owner_id","source_finding_id");--> statement-breakpoint
CREATE INDEX "eval_runs_batch_idx" ON "eval_runs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "eval_runs_case_idx" ON "eval_runs" USING btree ("case_id");