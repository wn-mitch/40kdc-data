import { Dataset } from "@alpaca-software/40kdc-data";

/** The embedded dataset — immutable for the life of the build, so one singleton. */
export const ds: Dataset = Dataset.embedded();
