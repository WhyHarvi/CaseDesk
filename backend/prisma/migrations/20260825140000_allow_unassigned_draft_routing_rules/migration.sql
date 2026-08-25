ALTER TABLE "lead_routing_rules" DROP CONSTRAINT "lead_routing_rules_target_user_id_fkey";
ALTER TABLE "lead_routing_rules" ALTER COLUMN "target_user_id" DROP NOT NULL;
ALTER TABLE "lead_routing_rules" ADD CONSTRAINT "lead_routing_rules_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
