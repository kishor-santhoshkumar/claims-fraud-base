# Running the Backend

FastAPI service exposing the two-stage cascade model (RandomForest gate → XGBoost ranker).

## 1. Open in VS Code

```powershell
code C:\Claims-Fraud-Risk-Detector
```

Select the interpreter: `Ctrl+Shift+P` → "Python: Select Interpreter" → `.venv\Scripts\python.exe`

## 2. First-time setup (skip if `.venv` already exists)

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

If `Activate.ps1` is blocked, run once: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

## 3. (Only if the model artifact is missing) Train it

```powershell
.venv\Scripts\python.exe src\train_final_model.py
```

Produces `outputs\model\cascade_model.joblib` and `outputs\model\gate_evaluation_report.txt`.

## 4. Start the server

```powershell
.venv\Scripts\python.exe -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000 --reload
```

`--reload` auto-restarts on code changes. Leave the terminal running.

## 5. Open the docs

http://localhost:8000/docs

## 6. Stop

`Ctrl+C` in the terminal.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/docs` | Swagger UI |
| GET | `/health` | Liveness check |
| GET | `/model/info` | Feature list, gate stats, training metadata |
| POST | `/predict` | Score one provider |
| POST | `/predict/batch` | Score a list of providers |

Input schema for `/predict` = the 31 pre-aggregated provider-level features (see `README.md` → Feature Engineering), not raw claims.

## Debug in VS Code (F5)

Add `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "FastAPI: uvicorn",
      "type": "debugpy",
      "request": "launch",
      "module": "uvicorn",
      "args": ["src.api.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload"],
      "cwd": "${workspaceFolder}",
      "justMyCode": true
    }
  ]
}
```
