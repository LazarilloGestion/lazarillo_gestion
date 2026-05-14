import * as path from "path";
import { config } from "dotenv";

// En tsx (CJS), este módulo se ejecuta en orden antes de que otros módulos
// lean process.env. Importar como primer side-effect en cada script.
config({ path: path.join(process.cwd(), ".env") });
config({ path: path.join(process.cwd(), ".env.local"), override: true });
