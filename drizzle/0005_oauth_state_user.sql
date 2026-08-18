ALTER TABLE `oauth_states` ADD `user_id` text REFERENCES `users`(`id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `oauth_states_user_idx` ON `oauth_states` (`user_id`,`provider`,`expires_at`);
