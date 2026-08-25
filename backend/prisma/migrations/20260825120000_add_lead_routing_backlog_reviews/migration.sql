CREATE TYPE "LeadRoutingBacklogReviewDecision" AS ENUM ('ASSIGNED', 'SKIPPED');

CREATE TABLE "lead_routing_backlog_reviews" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "decision" "LeadRoutingBacklogReviewDecision" NOT NULL,
    "previous_owner_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lead_routing_backlog_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_routing_backlog_reviews_rule_id_lead_id_key" ON "lead_routing_backlog_reviews"("rule_id", "lead_id");
CREATE INDEX "lead_routing_backlog_reviews_agency_id_rule_id_decision_reviewed_at_idx" ON "lead_routing_backlog_reviews"("agency_id", "rule_id", "decision", "reviewed_at");

ALTER TABLE "lead_routing_backlog_reviews" ADD CONSTRAINT "lead_routing_backlog_reviews_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_routing_backlog_reviews" ADD CONSTRAINT "lead_routing_backlog_reviews_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "lead_routing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_routing_backlog_reviews" ADD CONSTRAINT "lead_routing_backlog_reviews_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_routing_backlog_reviews" ADD CONSTRAINT "lead_routing_backlog_reviews_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
