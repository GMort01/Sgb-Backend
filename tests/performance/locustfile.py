import os
from urllib.parse import urlsplit

from locust import HttpUser, LoadTestShape, between, task
from locust.exception import StopUser


LOGIN_EMAIL = os.getenv("LOCUST_LOGIN_EMAIL")
LOGIN_PASSWORD = os.getenv("LOCUST_LOGIN_PASSWORD")
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1"}

if not LOGIN_EMAIL or not LOGIN_PASSWORD:
    raise RuntimeError("Define LOCUST_LOGIN_EMAIL y LOCUST_LOGIN_PASSWORD antes de iniciar Locust.")


class LibraryUser(HttpUser):
    wait_time = between(1, 2)

    def on_start(self):
        parsed_host = urlsplit(self.host or "")
        if parsed_host.scheme != "http" or parsed_host.hostname not in ALLOWED_HOSTS:
            raise StopUser("Locust solo puede apuntar al backend local (localhost/127.0.0.1).")

    @task(4)
    def get_catalog(self):
        with self.client.get("/api/recursos", name="GET /api/recursos", catch_response=True) as response:
            if response.status_code != 200:
                response.failure(f"HTTP {response.status_code}")
                return
            try:
                payload = response.json()
            except ValueError:
                response.failure("La respuesta no es JSON válido")
                return
            if payload.get("success") is not True:
                response.failure("La API no informó success=true")

    @task(1)
    def login(self):
        with self.client.post(
            "/api/auth/login",
            name="POST /api/auth/login",
            json={"correo": LOGIN_EMAIL, "password": LOGIN_PASSWORD},
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f"HTTP {response.status_code}")
                return
            try:
                payload = response.json()
            except ValueError:
                response.failure("La respuesta no es JSON válido")
                return
            if payload.get("success") is not True or not payload.get("data", {}).get("token"):
                response.failure("El login no devolvió un JWT")


PROFILE = os.getenv("LOCUST_PROFILE", "performance").lower()


if PROFILE == "performance":
    class SelectedLoadShape(LoadTestShape):
        def tick(self):
            if self.get_run_time() < 180:
                return 30, 5
            return None
elif PROFILE == "stress":
    class SelectedLoadShape(LoadTestShape):
        stages = (
            {"duration": 35, "users": 10, "spawn_rate": 5},
            {"duration": 70, "users": 50, "spawn_rate": 5},
            {"duration": 105, "users": 100, "spawn_rate": 5},
            {"duration": 150, "users": 150, "spawn_rate": 10},
        )

        def tick(self):
            run_time = self.get_run_time()
            for stage in self.stages:
                if run_time < stage["duration"]:
                    return stage["users"], stage["spawn_rate"]
            return None
else:
    raise ValueError("LOCUST_PROFILE debe ser 'performance' o 'stress'.")
