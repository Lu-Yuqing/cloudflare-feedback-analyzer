-- Mock feedback data
INSERT INTO feedback (source, content, author, timestamp) VALUES
('support_ticket', 'The new dashboard is confusing. I cannot find the settings button.', 'user123', datetime('now', '-2 days')),
('support_ticket', 'Love the new features! Great work team!', 'user456', datetime('now', '-1 day')),
('email', 'The API response time has improved significantly. Thank you!', 'dev@company.com', datetime('now', '-3 days')),
('email', 'Experiencing frequent crashes on mobile app. Please fix ASAP.', 'mobile_user@email.com', datetime('now', '-1 day')),
('survey', 'Overall satisfied but would like more customization options', 'survey_user_1', datetime('now', '-5 days')),
('survey', 'The pricing is too high for small businesses', 'survey_user_2', datetime('now', '-4 days')),
('support_ticket', 'Feature request: Dark mode would be amazing!', 'user789', datetime('now', '-6 days')),
('email', 'Bug: Login button not working on Safari browser', 'safari_user@email.com', datetime('now', '-2 days')),
('survey', 'Excellent customer support, very responsive team', 'survey_user_3', datetime('now', '-3 days')),
('support_ticket', 'Need help with integration. Documentation is unclear.', 'dev_user', datetime('now', '-1 day')),
('email', 'The new UI is beautiful and intuitive!', 'design_lover@email.com', datetime('now', '-4 days')),
('survey', 'Would like to see more integrations with third-party tools', 'survey_user_4', datetime('now', '-2 days'));