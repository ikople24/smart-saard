//api/submittedreports/personal-info/[id].js
import dbConnect from "@/lib/dbConnect";
import SubmittedReport from "@/models/SubmittedReport";
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await dbConnect();

  const {
    query: { id },
  } = req;

  try {
    const report = await SubmittedReport.findById(id).select(
      "prefix fullName phone location community"
    );

    if (!report) {
      return res.status(404).json({ error: "ไม่พบข้อมูลผู้แจ้ง" });
    }

    return res.status(200).json(report);
  } catch (error) {
    console.error("Error fetching personal info:", error);
    return res.status(500).json({ error: "ไม่สามารถดึงข้อมูลผู้แจ้งได้" });
  }
}
