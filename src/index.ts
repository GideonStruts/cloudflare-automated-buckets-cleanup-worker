import { runCleanup } from "./cleanup.ts";
import type { Env } from "./env.ts";

export default {
  async scheduled(controller, env, _ctx): Promise<void> {
    const scheduledAt = new Date(controller.scheduledTime);
    const now = Number.isNaN(scheduledAt.getTime()) ? new Date() : scheduledAt;
    console.log(
      JSON.stringify({
        event: "cleanup_started",
        cron: controller.cron,
        scheduledTime: now.toISOString(),
      }),
    );
    await runCleanup(env, { now });
  },

  fetch(): Response {
    return new Response(
      "automated-bucket-cleanups deletes expired R2 database backups on a cron schedule (00:00 UTC).\n",
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  },
} satisfies ExportedHandler<Env>;
