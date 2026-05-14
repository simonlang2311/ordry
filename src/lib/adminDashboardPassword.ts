export const ADMIN_DASHBOARD_PASSWORD_KEY = "admin_dashboard_password";
export const ADMIN_DASHBOARD_PASSWORD_REQUIRED_KEY = "admin_dashboard_password_required";
export const DEFAULT_ADMIN_DASHBOARD_PASSWORD = "schnitzel";
export const DEFAULT_ADMIN_DASHBOARD_PASSWORD_REQUIRED = true;
export const ADMIN_DASHBOARD_AUTH_DURATION = 12 * 60 * 60 * 1000;

export const getAdminDashboardAuthKey = (restaurantId: string) =>
  `ordry_admin_dashboard_auth_${restaurantId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
