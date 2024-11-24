FROM python:3.12
RUN pip install poetry

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# install dependencies
WORKDIR /app
COPY pyproject.toml /app
RUN poetry config virtualenvs.create false
RUN poetry install --no-root --no-ansi --no-interaction

# Copy source code
COPY . /app

RUN git config --global --add safe.directory /app

# Run the app
CMD ["python", "map_dosaaf/frontend/flask/main.py"]