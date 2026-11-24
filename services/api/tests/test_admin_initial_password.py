"""Le mot de passe admin initial généré ne doit jamais apparaître dans les logs (audit 23/11/2026)."""
import logging
import os
import stat

from db import admin as admin_db


def test_initial_password_written_0600_and_not_logged(tmp_path, monkeypatch, caplog):
    monkeypatch.chdir(tmp_path)
    secret = "MotDePasseTres-Secret-42"
    with caplog.at_level(logging.DEBUG):
        path = admin_db._write_initial_admin_password(secret)
    assert path and os.path.isfile(path)
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert secret in open(path, encoding="utf-8").read()
    assert secret not in caplog.text


def test_initial_password_unwritable_returns_none(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "data").write_text("pas un dossier")   # data/ impossible à créer
    assert admin_db._write_initial_admin_password("x" * 20) is None
