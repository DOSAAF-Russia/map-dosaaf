import envyaml


def get_config():
    return envyaml.EnvYAML(
        "config.yml", ".env", include_environment=False, flatten=False
    ).export()
