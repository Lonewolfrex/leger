import { useLocalSearchParams } from "expo-router";
import ExpenseForm from "@/src/components/ExpenseForm";

export default function EditExpense() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExpenseForm mode="edit" expenseId={id} />;
}
