FROM python:3.11-slim

WORKDIR /app

# Install wget for healthcheck and psql for migrations
RUN apt-get update && apt-get install -y --no-install-recommends wget postgresql-client libmagic1 && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create schema.sql inline (will be available at /app/schema.sql)
RUN echo "Schema will be initialized via psql in entrypoint" > /app/schema.sql

EXPOSE 80

# Entrypoint script will run DB migrations before starting the server
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "80"]