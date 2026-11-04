CREATE TABLE `sleep_session_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`timestamp` integer NOT NULL,
	`stage` text NOT NULL,
	`target_f` real NOT NULL,
	`set_f` real NOT NULL,
	`reason` text NOT NULL,
	`detail` text,
	`dry_run` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sleep_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sleep_session_decisions_session_time` ON `sleep_session_decisions` (`session_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `sleep_session_room_readings` (
	`timestamp` integer PRIMARY KEY NOT NULL,
	`temperature_c` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sleep_session_settings` (
	`side` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sleep_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`side` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text,
	`start_source` text NOT NULL,
	`is_nap` integer DEFAULT false NOT NULL,
	`nap_requested` integer DEFAULT false NOT NULL,
	`wake_at` integer,
	`dry_run` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sleep_sessions_side_started` ON `sleep_sessions` (`side`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_sleep_sessions_side_ended` ON `sleep_sessions` (`side`,`ended_at`);