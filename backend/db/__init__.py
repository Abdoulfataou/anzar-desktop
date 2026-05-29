"""
db/ — Database package for ANZAR backend.

Re-exports all public symbols so that `from database import X` continues to work
via the backward-compatible shim in database.py.
"""

# Base infrastructure
from db.base import (
    Base,
    get_engine,
    get_sessionmaker,
    get_db,
    db_ping,
    init_db,
    _utcnow,
    _model_to_dict,
)

# Models
from db.models import (
    User,
    OtpCode,
    Credits,
    Transaction,
    UsageRecord,
    Project,
    Admin,
    PaymentIntent,
    StudentProject,
    RateLimit,
)

# Password
from db.password import hash_password, verify_password

# Users
from db.users import (
    get_user_by_email,
    create_user,
    update_last_login,
    change_user_password,
    deactivate_user,
    update_user_profile,
)

# Credits
from db.credits import (
    get_credits,
    add_credits,
    deduct_credits,
    has_credits,
)

# Usage
from db.usage import (
    record_usage,
    get_usage_history,
    get_transactions,
    get_usage_stats,
)

# Projects
from db.projects import (
    create_project,
    update_project,
    get_project,
    get_user_projects,
    delete_project,
    cleanup_old_projects,
)

# Rate Limits
from db.rate_limits import (
    record_rate_limit_hit,
    get_rate_limit_count,
    cleanup_rate_limits,
)

# OTP
from db.otp import (
    create_otp,
    verify_otp,
    get_recent_otp_count,
    cleanup_expired_otps,
)

# Admin
from db.admin import (
    create_default_admin,
    get_admin_by_email,
    get_admin_by_id,
    update_admin_last_login,
    update_admin_profile,
    change_admin_password,
    list_admins,
    admin_list_all_users,
    admin_get_user_detail,
    admin_update_user,
    admin_add_credits_to_user,
    admin_list_all_projects,
    admin_delete_project_any,
    admin_get_global_stats,
    admin_get_all_transactions,
    admin_get_all_usage,
)

# Payments
from db.payments import (
    create_payment_intent,
    admin_list_payment_intents,
    admin_mark_payment_intent_paid,
)

# Student
from db.student import (
    create_student_project,
    get_student_project,
    get_user_student_projects,
    update_student_project,
    delete_student_project,
)

__all__ = [
    # Base
    "Base", "get_engine", "get_sessionmaker", "get_db", "db_ping", "init_db",
    # Models
    "User", "OtpCode", "Credits", "Transaction", "UsageRecord",
    "Project", "Admin", "PaymentIntent", "StudentProject", "RateLimit",
    # Password
    "hash_password", "verify_password",
    # Users
    "get_user_by_email", "create_user", "update_last_login",
    "change_user_password", "deactivate_user", "update_user_profile",
    # Credits
    "get_credits", "add_credits", "deduct_credits", "has_credits",
    # Usage
    "record_usage", "get_usage_history", "get_transactions", "get_usage_stats",
    # Projects
    "create_project", "update_project", "get_project", "get_user_projects",
    "delete_project", "cleanup_old_projects",
    # Rate Limits
    "record_rate_limit_hit", "get_rate_limit_count", "cleanup_rate_limits",
    # OTP
    "create_otp", "verify_otp", "get_recent_otp_count", "cleanup_expired_otps",
    # Admin
    "create_default_admin", "get_admin_by_email", "get_admin_by_id",
    "update_admin_last_login", "update_admin_profile", "change_admin_password",
    "list_admins", "admin_list_all_users", "admin_get_user_detail",
    "admin_update_user", "admin_add_credits_to_user", "admin_list_all_projects",
    "admin_delete_project_any", "admin_get_global_stats",
    "admin_get_all_transactions", "admin_get_all_usage",
    # Payments
    "create_payment_intent", "admin_list_payment_intents", "admin_mark_payment_intent_paid",
    # Student
    "create_student_project", "get_student_project", "get_user_student_projects",
    "update_student_project", "delete_student_project",
]
