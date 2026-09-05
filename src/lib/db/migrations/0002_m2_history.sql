ALTER TABLE `conversations` ADD `title_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `title_updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `conversations_deleted_updated_idx` ON `conversations` (`deleted_at`,`updated_at`,`id`);