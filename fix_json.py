import pandas as pd
import json
import math

# Load the parquet file
df = pd.read_parquet('outputs/features_train.parquet')

# Rename Provider to provider_id and exclude fraud_label
df = df.rename(columns={'Provider': 'provider_id'})
df = df.drop(columns=['fraud_label'])

# Replace NaN with None before converting to dict
df = df.where(pd.notna(df), None)

# Convert to list of dicts
data = df.to_dict(orient='records')

# Verify and fix any remaining NaN/Inf values
for i, record in enumerate(data):
    for key, value in record.items():
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            print(f"Found NaN/Inf at record {i}, key {key}")
            record[key] = None

# Save to frontend
output_path = 'frontend/src/data/providers_raw.json'

with open(output_path, 'w') as f:
    json.dump(data, f, indent=2)

print(f'Created {output_path} with {len(data)} providers')

# Validate the JSON file is readable
with open(output_path, 'r') as f:
    loaded = json.load(f)
    print(f'✓ JSON validation passed: {len(loaded)} providers loaded')
