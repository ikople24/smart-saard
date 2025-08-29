const schools = [
  "โรงเรียนบ้านคำบง",
  "โรงเรียนดงมันพิทยาคม",
  "โรงเรียนบ้านดงมัน",
  "โรงเรียนบ้านสะอาดหนองเรือ",
  "โรงเรียนบ้านนาศรีดงเค็ง",
  "โรงเรียนบ้านหนองอ้อโคกสว่าง",
  "ศูนย์พัฒนาเด็กเล็ก",
];

const SchoolSelector = ({ selected, onSelect = () => {}, error }) => (
  <div className="mb-4">
    <div className="flex py-2 gap-2">
      <label className="block text-sm font-medium text-gray-800 mb-1">
        1.เลือกโรงเรียน
      </label>
      {error && <div className="text-red-500 text-sm ml-auto">{error}</div>}
    </div>
    <div className="flex flex-wrap gap-2">
      {schools.map((school) => (
        <button
          key={school}
          type="button"
          onClick={() => onSelect(school)}
          className={`btn btn-sm rounded-full px-4 py-2 text-base font-medium ${
            selected === school
              ? "bg-orange-400 text-white border-none"
              : "bg-orange-100 text-orange-500 hover:bg-orange-300 border-none"
          } transition duration-200 min-w-[120px] max-w-full sm:w-auto`}
        >
          {school}
        </button>
      ))}
    </div>
  </div>
);

export default SchoolSelector;
