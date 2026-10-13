CREATE TABLE "companion_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"redemption_secret_hash" text NOT NULL,
	"user_id" uuid,
	"interview_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companion_pairings" ADD CONSTRAINT "companion_pairings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_pairings" ADD CONSTRAINT "companion_pairings_interview_id_interview_sessions_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companion_pairings_code_hash_unique" ON "companion_pairings" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "companion_pairings_secret_hash_unique" ON "companion_pairings" USING btree ("redemption_secret_hash");--> statement-breakpoint
CREATE INDEX "companion_pairings_status_expires_idx" ON "companion_pairings" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "companion_pairings_user_idx" ON "companion_pairings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "companion_pairings_interview_idx" ON "companion_pairings" USING btree ("interview_id");