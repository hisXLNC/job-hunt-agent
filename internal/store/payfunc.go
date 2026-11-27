package store

import (
	"database/sql/driver"

	"modernc.org/sqlite"
)

// PayYear turns a role's pay as written into a yearly figure, 0 when it can't.
// The engine, which knows how pay is written, sets it; the database calls it
// as pay_year(pay) to sort and filter roles by pay.
var PayYear = func(string) int { return 0 }

func init() {
	sqlite.MustRegisterDeterministicScalarFunction("pay_year", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		s, _ := args[0].(string)
		if s == "" {
			return int64(0), nil
		}
		return int64(PayYear(s)), nil
	})
}
