'use client';

import React, { useState } from 'react';
import { Send, CheckCircle2, Sparkles, User, Phone, Mail, BookOpen, MessageSquare, ShieldCheck, X } from 'lucide-react';
import { coursesData } from '@/data/mockData';

interface EnrollmentFormProps {
  selectedCourseId?: string;
  onCourseChange?: (courseId: string) => void;
}

export const EnrollmentForm: React.FC<EnrollmentFormProps> = ({
  selectedCourseId = 'math',
  onCourseChange
}) => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    course: selectedCourseId,
    format: 'offline', // 'offline' | 'online'
    comment: ''
  });

  const [submittedData, setSubmittedData] = useState<typeof formData | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (name === 'course' && onCourseChange) {
      onCourseChange(value);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!formData.name.trim() || !formData.phone.trim()) {
      setErrorMsg('Пожалуйста, укажите ваше имя и контактный номер телефона.');
      return;
    }

    setIsSubmitting(true);

    // Simulate API call with timeout
    setTimeout(() => {
      setIsSubmitting(false);
      setSubmittedData({ ...formData });
      setShowSuccessModal(true);
      // Reset form
      setFormData({
        name: '',
        phone: '',
        email: '',
        course: selectedCourseId || 'math',
        format: 'offline',
        comment: ''
      });
    }, 600);
  };

  const getCourseTitle = (courseId: string) => {
    const found = coursesData.find((c) => c.id === courseId);
    return found ? found.title : courseId;
  };

  return (
    <section id="enroll" className="py-20 lg:py-28 relative bg-[#090e1b] border-y border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-bold uppercase tracking-wider mb-4">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Онлайн запись</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight mb-4">
              Запишитесь на <span className="gold-gradient-text">бесплатный пробный урок</span>
            </h2>
            <p className="text-slate-300 text-base sm:text-lg">
              Пройдите диагностику знаний, познакомьтесь с преподавателем и получите индивидуальный план подготовки на высокий балл.
            </p>
          </div>

          {/* Form Card */}
          <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-8 sm:p-12 shadow-2xl relative overflow-hidden">
            
            {/* Decorative background glow */}
            <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/10 rounded-full blur-[100px] pointer-events-none" />

            <form onSubmit={handleSubmit} className="space-y-6 relative z-10 text-left">
              
              {errorMsg && (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
                  {errorMsg}
                </div>
              )}

              {/* Grid 2 Columns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Ваше имя или имя ученика *
                  </label>
                  <div className="relative">
                    <User className="w-5 h-5 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      name="name"
                      required
                      placeholder="Иван Иванов"
                      value={formData.name}
                      onChange={handleChange}
                      className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors text-sm"
                    />
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Номер телефона *
                  </label>
                  <div className="relative">
                    <Phone className="w-5 h-5 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      name="phone"
                      required
                      placeholder="+7 (999) 000-00-00"
                      value={formData.phone}
                      onChange={handleChange}
                      className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors text-sm"
                    />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Электронная почта
                  </label>
                  <div className="relative">
                    <Mail className="w-5 h-5 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      name="email"
                      placeholder="ivanov@mail.ru"
                      value={formData.email}
                      onChange={handleChange}
                      className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors text-sm"
                    />
                  </div>
                </div>

                {/* Course Select */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Выберите курс *
                  </label>
                  <div className="relative">
                    <BookOpen className="w-5 h-5 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
                    <select
                      name="course"
                      value={formData.course}
                      onChange={handleChange}
                      className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-white focus:outline-none focus:border-amber-500 transition-colors text-sm appearance-none cursor-pointer"
                    >
                      {coursesData.map((course) => (
                        <option key={course.id} value={course.id} className="bg-slate-900 text-white">
                          {course.categoryLabel} — {course.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

              </div>

              {/* Format selection: Radio Buttons */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                  Удобный формат занятий
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label
                    className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                      formData.format === 'offline'
                        ? 'bg-amber-500/10 border-amber-500 text-white'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="format"
                      value="offline"
                      checked={formData.format === 'offline'}
                      onChange={handleChange}
                      className="text-amber-500 focus:ring-amber-500"
                    />
                    <div>
                      <span className="font-semibold block text-sm">Офлайн в Москве</span>
                      <span className="text-xs text-slate-400">Кампус в «Москва-Сити», аудитории</span>
                    </div>
                  </label>

                  <label
                    className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                      formData.format === 'online'
                        ? 'bg-amber-500/10 border-amber-500 text-white'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="format"
                      value="online"
                      checked={formData.format === 'online'}
                      onChange={handleChange}
                      className="text-amber-500 focus:ring-amber-500"
                    />
                    <div>
                      <span className="font-semibold block text-sm">Онлайн обучение</span>
                      <span className="text-xs text-slate-400">Интерактивная платформа и живые трансляции</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Comments */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Комментарий или текущий класс ученика (по желанию)
                </label>
                <div className="relative">
                  <MessageSquare className="w-5 h-5 text-slate-500 absolute left-4 top-4" />
                  <textarea
                    name="comment"
                    rows={3}
                    placeholder="Например: 10 класс, хотим сдать ЕГЭ на 90+ и подтянуть геометрию"
                    value={formData.comment}
                    onChange={handleChange}
                    className="w-full pl-12 pr-4 py-3 rounded-xl bg-slate-950/80 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors text-sm"
                  />
                </div>
              </div>

              {/* Submit Button & Privacy */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Ваши данные строго конфиденциальны и защищены</span>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-8 py-4 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 hover:shadow-xl hover:shadow-amber-500/25 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 text-base cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-5 h-5" />
                  <span>{isSubmitting ? 'Отправка заявки...' : 'Отправить заявку на урок'}</span>
                </button>
              </div>

            </form>
          </div>

        </div>

      </div>

      {/* Success Modal */}
      {showSuccessModal && submittedData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-lg p-6 sm:p-8 rounded-3xl bg-[#0b132b] border border-amber-500/40 shadow-2xl text-left">
            
            <button
              onClick={() => setShowSuccessModal(false)}
              className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <h3 className="text-2xl font-black text-white mb-2">
              Заявка успешно принята!
            </h3>
            
            <p className="text-slate-300 text-sm mb-6 leading-relaxed">
              Спасибо, <strong className="text-white">{submittedData.name}</strong>! Мы получили вашу заявку на бесплатный пробный урок. Наш академический куратор свяжется с вами по номеру <strong className="text-amber-400">{submittedData.phone}</strong> в течение 15 минут.
            </p>

            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-2 mb-6">
              <div className="text-slate-400">
                Выбранный курс: <span className="text-white font-medium">{getCourseTitle(submittedData.course)}</span>
              </div>
              <div className="text-slate-400">
                Формат: <span className="text-white font-medium">{submittedData.format === 'offline' ? 'Офлайн (Москва-Сити)' : 'Онлайн'}</span>
              </div>
              {submittedData.email && (
                <div className="text-slate-400">
                  Email для материалов: <span className="text-white font-medium">{submittedData.email}</span>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowSuccessModal(false)}
              className="w-full py-3.5 rounded-xl font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition-colors text-center"
            >
              Понятно, спасибо
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
