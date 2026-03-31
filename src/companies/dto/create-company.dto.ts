import { IsNotEmpty } from "class-validator";

export class CreateCompanyDto {
    @IsNotEmpty({message: "Tên không được để trống"})
    name: string;

    @IsNotEmpty({message: "Địa chỉ không được để trống"})   
    address: string;

    @IsNotEmpty ({message: "Mô tả không được để trống"})
    description: string;

    
}

